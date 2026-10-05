'use client'

import { Fragment, Suspense, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { format } from 'date-fns'
import { formatDate, countWorkingDays } from '@/lib/date-utils'
import { Plus, Trash2, Upload, Download, Filter, Pencil, Search, RefreshCw, List, CalendarDays, BarChart3, Send } from 'lucide-react'
import HolidayModal from '@/components/modals/HolidayModal'
import VacationModal from '@/components/modals/VacationModal'
import VacationCsvImportModal from '@/components/modals/VacationCsvImportModal'
import VacationSyncModal from '@/components/modals/VacationSyncModal'
import HolidaysBotModal from '@/components/modals/HolidaysBotModal'
import HolidaysCalendar from '@/components/holidays/HolidaysCalendar'
import VacationTotals from '@/components/holidays/VacationTotals'
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
  if (isNaN(new Date(start).getTime()) || isNaN(new Date(end).getTime())) return '—'
  return countWorkingDays(start, end)
}

const lastSyncFormatter = new Intl.DateTimeFormat('es', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

function HolidaysPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const qc = useQueryClient()
  const { data: session } = useSession()
  const isAdmin = ((session?.user as { roles?: string[] })?.roles ?? []).includes('admin')
  const [showHolidayModal, setShowHolidayModal] = useState(false)
  const [editHoliday, setEditHoliday] = useState<CountryHoliday | null>(null)
  const [showVacationModal, setShowVacationModal] = useState(false)
  const [showVacationCsvModal, setShowVacationCsvModal] = useState(false)
  const [showCsvModal, setShowCsvModal] = useState(false)
  const [showSyncModal, setShowSyncModal] = useState(false)
  const [showHolidaysBotModal, setShowHolidaysBotModal] = useState(false)

  // view/país/búsqueda reflejados en la URL (deep-linkable, sobreviven un
  // reload) — view y país son clicks/selects, se escriben directo a la URL;
  // la búsqueda de texto usa estado local (responsive al tipear) + se
  // empuja a la URL como efecto, mismo criterio que /projects.
  const setParams = (patch: Record<string, string>) => {
    const sp = new URLSearchParams(searchParams.toString())
    Object.entries(patch).forEach(([k, v]) => (v ? sp.set(k, v) : sp.delete(k)))
    router.replace(`/holidays?${sp.toString()}`, { scroll: false })
  }
  const view = (searchParams.get('view') as 'list' | 'calendar' | 'totals') ?? 'calendar'
  const setView = (v: 'list' | 'calendar' | 'totals') => setParams({ view: v })
  const filterCountry = searchParams.get('country') ?? ''
  const setFilterCountry = (country: string) => setParams({ country })
  const [vacationSearch, setVacationSearchState] = useState(searchParams.get('q') ?? '')
  const setVacationSearch = (q: string) => { setVacationSearchState(q); setParams({ q }) }

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

  const { data: lastHolidaysBotRun } = useQuery<SyncRunSummary | null>({
    queryKey: ['holidays-bot-last'],
    queryFn: () => fetch('/api/holidays-bot/send').then((r) => (r.ok ? r.json() : null)),
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

  const deleteVacation = async (v: Vacation) => {
    const ok = await confirmDialog({
      title: `¿Eliminar esta vacación de ${v.resource?.name ?? 'este recurso'}?`,
      description: `${formatDate(v.startDate)} – ${formatDate(v.endDate)}. Esta acción no se puede deshacer.`,
    })
    if (!ok) return
    await fetch(`/api/vacations/${v.id}`, { method: 'DELETE' })
    qc.invalidateQueries({ queryKey: ['vacations'] })
    qc.invalidateQueries({ queryKey: ['gantt'] })
  }

  const handleDownload = () => {
    const params = filterCountry ? `?country=${encodeURIComponent(filterCountry)}` : ''
    window.open(`/api/country-holidays/export${params}`, '_blank')
  }

  // Upcoming vacations first (soonest on top), then past ones (most recent
  // first) — "which vacations are coming up" is the whole point of this list.
  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const sortedVacations = useMemo(() => {
    const upcoming = vacations.filter((v) => v.startDate.slice(0, 10) >= todayStr)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
    const past = vacations.filter((v) => v.startDate.slice(0, 10) < todayStr)
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
    return [...upcoming, ...past]
  }, [vacations, todayStr])

  // Filter vacations by resource name/email, then paginate client-side.
  const filteredVacations = vacationSearch.trim()
    ? sortedVacations.filter((v) => {
        const q = vacationSearch.trim().toLowerCase()
        return v.resource?.name.toLowerCase().includes(q) || v.resource?.email?.toLowerCase().includes(q)
      })
    : sortedVacations
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
            {([['calendar', 'Calendario', CalendarDays], ['list', 'Lista', List], ['totals', 'Totales', BarChart3]] as const).map(([key, label, Icon]) => (
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
          {isAdmin && (
            <button
              onClick={() => setShowHolidaysBotModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm min-h-[40px]"
            >
              <Send size={14} /> Holidays Bot
            </button>
          )}
        </div>
      </div>
      {isAdmin && lastSync && (
        <p className={`text-xs ${lastSync.ok ? 'text-gray-500' : 'text-red-600'}`}>
          Última sincronización: {lastSyncFormatter.format(new Date(lastSync.ranAt))} ({lastSync.trigger === 'cron' ? 'automática' : 'manual'})
          {lastSync.ok
            ? ` · ${lastSync.created} creadas, ${lastSync.updated} actualizadas, ${lastSync.deleted} borradas${lastSync.unmatchedCount ? `, ${lastSync.unmatchedCount} mail(s) sin match` : ''}`
            : ' · falló'}
        </p>
      )}
      {isAdmin && lastHolidaysBotRun && (
        <p className={`text-xs ${lastHolidaysBotRun.ok ? 'text-gray-500' : 'text-red-600'}`}>
          Último envío a Slack (Holidays Bot): {lastSyncFormatter.format(new Date(lastHolidaysBotRun.ranAt))} ({lastHolidaysBotRun.trigger === 'cron' ? 'automático' : 'manual'})
          {lastHolidaysBotRun.ok
            ? ` · ${lastHolidaysBotRun.created} país(es), ${lastHolidaysBotRun.updated} feriado(s)`
            : ' · falló'}
        </p>
      )}

      {view === 'calendar' && <HolidaysCalendar vacations={vacations} holidays={countryHolidays} />}

      {view === 'totals' && (
        <VacationTotals vacations={isAdmin ? vacations : vacations.filter((v) => v.resourceId === myResource?.id)} />
      )}

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
                name="vacation-search"
                autoComplete="off"
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
                  <td className="px-4 py-3 max-w-[200px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: v.resource?.color ?? '#ccc' }} />
                      <span className="font-medium truncate">{v.resource?.name ?? '—'}</span>
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
                      <button
                        onClick={() => deleteVacation(v)}
                        aria-label={`Eliminar vacación de ${v.resource?.name ?? 'este recurso'}`}
                        className="text-red-400 hover:text-red-600"
                      >
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
      {isAdmin && <HolidaysBotModal open={showHolidaysBotModal} onClose={() => setShowHolidaysBotModal(false)} />}
      {isAdmin && <CsvImportModal open={showCsvModal} onClose={() => setShowCsvModal(false)} />}
    </div>
  )
}

export default function HolidaysPage() {
  return (
    <Suspense>
      <HolidaysPageInner />
    </Suspense>
  )
}
