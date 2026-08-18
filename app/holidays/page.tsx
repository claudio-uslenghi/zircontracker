'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { eachDayOfInterval, isWeekend, parseISO } from 'date-fns'
import { formatDate } from '@/lib/date-utils'
import { Plus, Trash2, Upload, Download, Filter, Pencil } from 'lucide-react'
import HolidayModal from '@/components/modals/HolidayModal'
import VacationModal from '@/components/modals/VacationModal'
import CsvImportModal from '@/components/modals/CsvImportModal'
import type { Resource, Vacation, CountryHoliday } from '@/types'
import { FLAG_BY_NAME } from '@/lib/countries'

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
  const [showCsvModal, setShowCsvModal] = useState(false)
  const [filterCountry, setFilterCountry] = useState<string>('')

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

  const { data: vacations = [] } = useQuery<Vacation[]>({
    queryKey: ['vacations'],
    queryFn: () => fetch('/api/vacations').then((r) => r.json()),
  })

  const deleteCountryHoliday = async (id: number) => {
    if (!confirm('¿Eliminar este feriado? Se eliminará para todos los recursos del país.')) return
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

  // Derive countries dynamically from data (sorted alphabetically)
  const availableCountries = Array.from(new Set(countryHolidays.map((h) => h.country))).sort()

  // Filter and group by country
  const filtered = filterCountry
    ? countryHolidays.filter((h) => h.country === filterCountry)
    : countryHolidays

  const grouped = availableCountries.reduce<Record<string, CountryHoliday[]>>((acc, c) => {
    const items = filtered.filter((h) => h.country === c)
    if (items.length) acc[c] = items
    return acc
  }, {})

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-bold text-gray-800">Vacaciones & Feriados</h1>

      {/* ── VACATIONS ──────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-700">Vacaciones programadas</h2>
          <button
            onClick={() => setShowVacationModal(true)}
            disabled={!isAdmin && !myResource}
            title={!isAdmin && !myResource ? 'Tu usuario no está vinculado a ningún recurso' : undefined}
            className="flex items-center gap-2 px-3 py-1.5 bg-[#0170B9] text-white rounded-lg hover:bg-[#005a94] transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={14} /> Agregar vacación
          </button>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#0170B9] text-white">
                <th className="px-4 py-3 text-left">Recurso</th>
                <th className="px-4 py-3 text-left">País</th>
                <th className="px-4 py-3 text-left">Desde</th>
                <th className="px-4 py-3 text-left">Hasta</th>
                <th className="px-4 py-3 text-right">Días hábiles</th>
                <th className="px-4 py-3 text-left">Notas</th>
                <th className="px-4 py-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {vacations.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-6 text-gray-400">Sin vacaciones registradas</td></tr>
              ) : vacations.map((v) => (
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
        </div>
      </section>

      {/* ── HOLIDAYS BY COUNTRY ─────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-700">Feriados por País</h2>
          <div className="flex items-center gap-2">
            {/* Country filter */}
            <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-sm">
              <Filter size={13} className="text-gray-400" />
              <select
                value={filterCountry}
                onChange={(e) => setFilterCountry(e.target.value)}
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

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
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
        </div>

        <p className="text-xs text-gray-400 mt-2">
          Los feriados se aplican automáticamente a todos los recursos del país. Al agregar un recurso nuevo, hereda los feriados de su país.
        </p>
      </section>

      {isAdmin && (
        <HolidayModal open={showHolidayModal} onClose={() => { setShowHolidayModal(false); setEditHoliday(null) }} editHoliday={editHoliday} />
      )}
      <VacationModal
        open={showVacationModal}
        onClose={() => setShowVacationModal(false)}
        lockedResource={isAdmin ? undefined : (myResource ? { id: myResource.id, name: myResource.name } : undefined)}
      />
      {isAdmin && <CsvImportModal open={showCsvModal} onClose={() => setShowCsvModal(false)} />}
    </div>
  )
}
