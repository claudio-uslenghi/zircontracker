'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { eachDayOfInterval, isWeekend, parseISO, format } from 'date-fns'
import { formatDate } from '@/lib/date-utils'
import { Plus, Trash2, Upload, Download, Filter, Pencil, Search, RefreshCw, List, CalendarDays } from 'lucide-react'
import HolidayModal from '@/components/modals/HolidayModal'
import VacationModal from '@/components/modals/VacationModal'
import VacationCsvImportModal from '@/components/modals/VacationCsvImportModal'
import VacationSyncModal from '@/components/modals/VacationSyncModal'
import HolidaysCalendar from '@/components/holidays/HolidaysCalendar'
import CsvImportModal from '@/components/modals/CsvImportModal'
import Pagination from '@/components/ui/Pagination'
import type { Resource, Vacation, CountryHoliday, SyncRunSummary } from '@/types'
import { FLAG_BY_NAME } from '@/lib/countries'
import { confirmDialog } from '@/lib/confirm-dialog'

function countryLabel(name: string) {
  const flag = FLAG_BY_NAME[name] ?? '🌍'
  return `${flag} ${name}`
}

function calcWorkingDays(start: string, end: string) {
  try {
    const days = eachDayOfInterval({ start: parseISO(start), end: parseISO(end) })
    return days.filter((d) => !isWeekend(d)).length
  } catch { return '—' }
}

export default function HolidaysPage() {
  const qc = useQueryClient()
  const { data: session } = useSession()
  const isAdmin = ((session?.user as { roles?: string[] })?.roles ?? []).includes('admin')
  const [showHolidayModal, setShowHolidayModal] = useState(false)
  const [editHoliday, setEditHoliday] = useState<CountryHoliday | null>(null)
  const [showVacationModal, setShowVacationModal] = useState(false)
  const [showVacationCsvModal, setShowVacationCsvModal] = useState(false)
  const [showCsvModal, setShowCsvModal] = useState(false)
  const [filterCountry, setFilterCountry] = useState<string>('')
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [showSyncModal, setShowSyncModal] = useState(false)

  const [vacationSearch, setVacationSearch] = useState('')
  const [vacationPage, setVacationPage] = useState(1)
  const [vacationPageSize, setVacationPageSize] = useState(10)

  const [holidayPage, setHolidayPage] = useState(1)
  const [holidayPageSize, setHolidayPageSize] = useState(10)

  const { data: myResource } = useQuery<Resource>({
    queryKey: ['me-resource'],
    queryFn: async () => {
      const res = await fetch('/api/me/resource')
      if (!res.ok) return undefined as unknown as Resource
      return res.json()
    },
    enabled: !isAdmin,
    retry: false,
  })

  const { data: countryHolidays = [] } = useQuery<CountryHoliday[]>({
    queryKey: ['country-holidays'],
    queryFn: () => fetch('/api/country-holidays').then((r) => r.json()),
  })

  const { data: lastSync } = useQuery<SyncRunSummary | null>({
    queryKey: ['vacation-sync-last'],
    queryFn: () => fetch('/api/vacations/sync').then((r) => (r.ok ? r.json() : null)),
    enabled: isAdmin,
  })

  const { data: vacations = [] } = useQuery<Vacation[]>({
    queryKey: ['vacations'],
    queryFn: () => fetch('/api/vacations').then((r) => r.json()),
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

  const deleteVacation = async (id: number) => {
    await fetch(`/api/vacations/${id}`, { method: 'DELETE' })
    qc.invalidateQueries({ queryKey: ['vacations'] })
    qc.invalidateQueries({ queryKey: ['gantt'] })
  }

  const handleDownload = () => {
    const params = filterCountry ? `?country=${encodeURIComponent(filterCountry)}` : ''
    window.open(`/api/country-holidays/export${params}`, '_blank')
  }

  // Filter vacations by resource name/email, then paginate client-side.
  const filteredVacations = vacationSearch.trim()
    ? vacations.filter((v) => {
        const q = vacationSearch.trim().toLowerCase()
        return v.resource?.name.toLowerCase().includes(q) || v.resource?.email?.toLowerCase().includes(q)
      })
    : vacations
  const vacationTotalPages = Math.max(1, Math.ceil(filteredVacations.length / vacationPageSize))
  const vacationPageClamped = Math.min(vacationPage, vacationTotalPages)
  const pagedVacations = filteredVacations.slice(
    (vacationPageClamped - 1) * vacationPageSize,
    vacationPageClamped * vacationPageSize
  )

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
        <h1 className="text-xl sm:text-2xl font-bold text-gray-800">Vacaciones & Feriados</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5" role="group" aria-label="Vista">
            {([['list', 'Lista', List], ['calendar', 'Calendario', CalendarDays]] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setView(key)}
                aria-pressed={view === key}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-md min-h-[40px] transition-colors ${
                  view === key ? 'bg-[#0170B9] text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowSyncModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm min-h-[40px]"
            >
              <RefreshCw size={14} /> Sincronizar con Google Sheet
            </button>
          )}
        </div>
      </div>
      {isAdmin && lastSync && (
        <p className={`text-xs ${lastSync.ok ? 'text-gray-500' : 'text-red-600'}`}>
          Última sincronización: {format(new Date(lastSync.ranAt), 'dd/MM/yyyy HH:mm')} ({lastSync.trigger === 'cron' ? 'automática' : 'manual'})
          {lastSync.ok
            ? ` · ${lastSync.created} creadas, ${lastSync.updated} actualizadas, ${lastSync.deleted} borradas${lastSync.unmatchedCount ? `, ${lastSync.unmatchedCount} mail(s) sin match` : ''}`
            : ' · falló'}
        </p>
      )}

      {view === 'calendar' && <HolidaysCalendar vacations={vacations} holidays={countryHolidays} />}

      {view === 'list' && (
      <>

      {/* ── VACATIONS ──────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 className="text-lg font-semibold text-gray-700">Vacaciones programadas</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-sm">
              <Search size={13} className="text-gray-400" />
              <input
                type="text"
                value={vacationSearch}
                onChange={(e) => { setVacationSearch(e.target.value); setVacationPage(1) }}
                placeholder="Buscar por nombre o email..."
                className="text-sm text-gray-700 bg-transparent outline-none w-44"
              />
            </div>
            {isAdmin && (
              <button
                onClick={() => setShowVacationCsvModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3a3a3a] text-white rounded-lg hover:bg-[#222] transition-colors text-sm"
              >
                <Upload size={14} /> Importar CSV
              </button>
            )}
            <button
              onClick={() => setShowVacationModal(true)}
              disabled={!isAdmin && !myResource}
              title={!isAdmin && !myResource ? 'Tu usuario no está vinculado a ningún recurso' : undefined}
              className="flex items-center gap-2 px-3 py-1.5 bg-[#0170B9] text-white rounded-lg hover:bg-[#005a94] transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={14} /> Agregar vacación
            </button>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#0170B9] text-white">
                <th className="px-4 py-3 text-left">Recurso</th>
                <th className="px-4 py-3 text-left">País</th>
                <th className="px-4 py-3 text-left">Desde</th>
                <th className="px-4 py-3 text-left">Hasta</th>
                <th className="px-4 py-3 text-right">Días hábiles</th>
                <th className="px-4 py-3 text-left">Tipo</th>
                <th className="px-4 py-3 text-left">Notas</th>
                <th className="px-4 py-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredVacations.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-6 text-gray-400">
                    {vacations.length === 0 ? 'Sin vacaciones registradas' : 'Sin resultados para la búsqueda'}
                  </td>
                </tr>
              ) : pagedVacations.map((v) => (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: v.resource?.color ?? '#ccc' }} />
                      <span className="font-medium">{v.resource?.name ?? '—'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{countryLabel(v.resource?.country ?? 'Otro')}</td>
                  <td className="px-4 py-3">{formatDate(v.startDate)}</td>
                  <td className="px-4 py-3">{formatDate(v.endDate)}</td>
                  <td className="px-4 py-3 text-right font-medium">{calcWorkingDays(v.startDate, v.endDate)} días</td>
                  <td className="px-4 py-3 text-gray-500">{v.type}{v.halfDay ? ' (½ día)' : ''}</td>
                  <td className="px-4 py-3 text-gray-500">{v.notes || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    {(isAdmin || myResource?.id === v.resourceId) && (
                      <button onClick={() => deleteVacation(v.id)} className="text-red-400 hover:text-red-600">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={vacationPageClamped}
            pageSize={vacationPageSize}
            totalItems={filteredVacations.length}
            onPageChange={setVacationPage}
            onPageSizeChange={(size) => { setVacationPageSize(size); setVacationPage(1) }}
          />
        </div>
      </section>

      {/* ── HOLIDAYS BY COUNTRY ─────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 className="text-lg font-semibold text-gray-700">Feriados por País</h2>
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
                  <>
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
                                title="Editar"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                onClick={() => deleteCountryHoliday(h.id)}
                                className="text-red-400 hover:text-red-600 transition-colors"
                                title="Eliminar"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </>
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
          Los feriados se aplican automáticamente a todos los recursos del país. Al agregar un recurso nuevo, hereda los feriados de su país.
        </p>
      </section>
      </>
      )}

      {isAdmin && (
        <HolidayModal open={showHolidayModal} onClose={() => { setShowHolidayModal(false); setEditHoliday(null) }} editHoliday={editHoliday} />
      )}
      <VacationModal
        open={showVacationModal}
        onClose={() => setShowVacationModal(false)}
        lockedResource={isAdmin ? undefined : (myResource ? { id: myResource.id, name: myResource.name } : undefined)}
      />
      {isAdmin && <VacationCsvImportModal open={showVacationCsvModal} onClose={() => setShowVacationCsvModal(false)} />}
      {isAdmin && <VacationSyncModal open={showSyncModal} onClose={() => setShowSyncModal(false)} />}
      {isAdmin && <CsvImportModal open={showCsvModal} onClose={() => setShowCsvModal(false)} />}
    </div>
  )
}
