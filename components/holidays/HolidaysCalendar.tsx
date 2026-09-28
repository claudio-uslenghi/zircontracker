'use client'

import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import SearchableSelect from '@/components/ui/SearchableSelect'
import { FLAG_BY_NAME } from '@/lib/countries'
import type { CountryHoliday, Vacation } from '@/types'

interface Props {
  vacations: Vacation[]
  holidays: CountryHoliday[]
}

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const MAX_CHIPS = 3

const TYPE_STYLES: Record<string, { chip: string; dot: string; label: string }> = {
  'Vacation / Day Off': { chip: 'bg-blue-100 text-blue-900', dot: 'bg-blue-500', label: 'Vacaciones' },
  'Sick Day': { chip: 'bg-red-100 text-red-900', dot: 'bg-red-500', label: 'Enfermedad' },
  Birthday: { chip: 'bg-purple-100 text-purple-900', dot: 'bg-purple-500', label: 'Cumpleaños' },
}
const FALLBACK_STYLE = { chip: 'bg-gray-100 text-gray-800', dot: 'bg-gray-500', label: 'Otro' }
const styleOf = (type: string) => TYPE_STYLES[type] ?? FALLBACK_STYLE

const ymd = (d: Date) => d.toISOString().slice(0, 10)
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`)
// For display with date-fns format(): a UTC-midnight Date would render as the
// previous day in negative-offset timezones (Argentina/Uruguay are UTC-3).
const localDate = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
function addDays(iso: string, n: number) {
  const d = utc(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return ymd(d)
}
const isWeekend = (iso: string) => [0, 6].includes(utc(iso).getUTCDay())
const flag = (country: string) => FLAG_BY_NAME[country] ?? '🌍'

interface Absence {
  vacation: Vacation
  name: string
}

interface DayData {
  holidays: CountryHoliday[]
  absences: Absence[]
}

export default function HolidaysCalendar({ vacations, holidays }: Props) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [cursor, setCursor] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }))
  const [selected, setSelected] = useState<string | null>(today)
  const [personId, setPersonId] = useState('')
  const [country, setCountry] = useState('')
  const [type, setType] = useState('')

  const personOptions = useMemo(() => {
    const seen = new Map<number, string>()
    for (const v of vacations) if (v.resource) seen.set(v.resourceId, v.resource.name.trim())
    return [
      { value: '', label: 'Todas las personas' },
      ...Array.from(seen.entries()).map(([id, name]) => ({ value: String(id), label: name })).sort((a, b) => a.label.localeCompare(b.label)),
    ]
  }, [vacations])

  const countries = useMemo(() => {
    const set = new Set<string>()
    holidays.forEach((h) => set.add(h.country))
    vacations.forEach((v) => v.resource?.country && set.add(v.resource.country))
    return Array.from(set).sort()
  }, [holidays, vacations])

  const first = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-01`
  const daysInMonth = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate()
  const offset = (utc(first).getUTCDay() + 6) % 7 // Monday first
  const weeks = Math.ceil((offset + daysInMonth) / 7)
  const gridStart = addDays(first, -offset)
  const gridEnd = addDays(gridStart, weeks * 7 - 1)
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i))

  const byDay = useMemo(() => {
    const map = new Map<string, DayData>()
    const day = (iso: string) => {
      let d = map.get(iso)
      if (!d) map.set(iso, (d = { holidays: [], absences: [] }))
      return d
    }
    for (const h of holidays) {
      if (country && h.country !== country) continue
      const iso = String(h.date).slice(0, 10)
      if (iso >= gridStart && iso <= gridEnd) day(iso).holidays.push(h)
    }
    // Overlapping rows for the same person (e.g. a hand-loaded range plus the
    // sheet rows it merges) must not show the person twice on one day.
    const seen = new Set<string>()
    for (const v of vacations) {
      if (personId && String(v.resourceId) !== personId) continue
      if (country && v.resource?.country !== country) continue
      if (type && v.type !== type) continue
      const start = String(v.startDate).slice(0, 10)
      const end = String(v.endDate).slice(0, 10)
      const name = v.resource?.name.trim() ?? `#${v.resourceId}`
      // Absences only on working days, same as "Días hábiles" in the list.
      for (let iso = start < gridStart ? gridStart : start; iso <= end && iso <= gridEnd; iso = addDays(iso, 1)) {
        if (isWeekend(iso)) continue
        const key = `${iso}|${v.resourceId}|${v.type}|${v.halfDay}`
        if (seen.has(key)) continue
        seen.add(key)
        day(iso).absences.push({ vacation: v, name })
      }
    }
    map.forEach((d) => d.absences.sort((a, b) => a.name.localeCompare(b.name)))
    return map
  }, [holidays, vacations, country, personId, type, gridStart, gridEnd])

  const shift = (delta: number) =>
    setCursor((c) => {
      const d = new Date(Date.UTC(c.y, c.m + delta, 1))
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() }
    })
  const goToday = () => {
    setCursor({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 })
    setSelected(today)
  }

  const monthLabel = format(new Date(cursor.y, cursor.m, 1), 'MMMM yyyy', { locale: es })
  const selectedData = selected ? byDay.get(selected) : undefined

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 bg-white rounded-xl border border-gray-200 p-3">
        <div className="flex flex-col gap-1 min-w-[180px] flex-1 sm:flex-none">
          <label className="text-xs text-gray-500 font-medium">Persona</label>
          <SearchableSelect
            value={personId}
            onChange={setPersonId}
            options={personOptions}
            placeholder="Todas las personas"
            className="border border-gray-300 rounded px-2 py-2 text-sm w-full"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cal-country" className="text-xs text-gray-500 font-medium">País</label>
          <select id="cal-country" value={country} onChange={(e) => setCountry(e.target.value)} className="border border-gray-300 rounded px-2 py-2 text-sm bg-white">
            <option value="">Todos</option>
            {countries.map((c) => <option key={c} value={c}>{flag(c)} {c}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cal-type" className="text-xs text-gray-500 font-medium">Tipo</label>
          <select id="cal-type" value={type} onChange={(e) => setType(e.target.value)} className="border border-gray-300 rounded px-2 py-2 text-sm bg-white">
            <option value="">Todos</option>
            {Object.entries(TYPE_STYLES).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Month navigation */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100">
          <div className="flex items-center gap-1">
            <button onClick={() => shift(-1)} aria-label="Mes anterior" className="p-2 rounded hover:bg-gray-100 min-w-[44px] min-h-[44px] flex items-center justify-center">
              <ChevronLeft size={18} />
            </button>
            <button onClick={() => shift(1)} aria-label="Mes siguiente" className="p-2 rounded hover:bg-gray-100 min-w-[44px] min-h-[44px] flex items-center justify-center">
              <ChevronRight size={18} />
            </button>
          </div>
          <h3 className="text-base font-semibold text-gray-800 capitalize text-center flex-1">{monthLabel}</h3>
          <button onClick={goToday} className="px-3 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50 min-h-[44px]">Hoy</button>
        </div>

        {/* Weekday header */}
        <div className="grid grid-cols-7 bg-[#0170B9] text-white text-xs font-semibold">
          {WEEKDAYS.map((w) => <div key={w} className="py-1.5 text-center">{w}</div>)}
        </div>

        {/* Days */}
        <div className="grid grid-cols-7">
          {cells.map((iso) => {
            const inMonth = iso.slice(0, 7) === first.slice(0, 7)
            const data = byDay.get(iso)
            const chips = [
              ...(data?.holidays.map((h) => ({ key: `h${h.id}`, text: `${flag(h.country)} ${h.name}`, cls: 'bg-amber-100 text-amber-900', dot: 'bg-amber-500' })) ?? []),
              ...(data?.absences.map((a) => ({
                key: `v${a.vacation.id}`,
                text: `${a.name}${a.vacation.halfDay ? ' ½' : ''}`,
                cls: styleOf(a.vacation.type).chip,
                dot: styleOf(a.vacation.type).dot,
              })) ?? []),
            ]
            const isSelected = selected === iso
            const label = `${format(localDate(iso), "d 'de' MMMM", { locale: es })}: ${chips.length} evento${chips.length === 1 ? '' : 's'}`
            return (
              <button
                key={iso}
                onClick={() => setSelected(iso)}
                aria-label={label}
                aria-pressed={isSelected}
                className={`min-h-[52px] sm:min-h-[92px] border-t border-l border-gray-100 p-1 text-left align-top flex flex-col gap-0.5 transition-colors ${
                  isWeekend(iso) ? 'bg-gray-50' : 'bg-white'
                } ${!inMonth ? 'opacity-40' : ''} ${isSelected ? 'ring-2 ring-inset ring-[#0170B9]' : 'hover:bg-blue-50'}`}
              >
                <span className={`text-xs font-medium self-end sm:self-start ${iso === today ? 'bg-[#0170B9] text-white rounded-full w-5 h-5 flex items-center justify-center' : 'text-gray-600'}`}>
                  {Number(iso.slice(8))}
                </span>
                {/* Desktop: readable chips */}
                <span className="hidden sm:flex flex-col gap-0.5 w-full">
                  {chips.slice(0, MAX_CHIPS).map((c) => (
                    <span key={c.key} className={`truncate rounded px-1 py-0.5 text-[11px] leading-tight ${c.cls}`}>{c.text}</span>
                  ))}
                  {chips.length > MAX_CHIPS && <span className="text-[11px] text-gray-500">+{chips.length - MAX_CHIPS} más</span>}
                </span>
                {/* Mobile: colored dots + count (details shown below the grid) */}
                <span className="flex sm:hidden flex-wrap gap-0.5 justify-center w-full">
                  {chips.slice(0, 4).map((c) => <span key={c.key} className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />)}
                  {chips.length > 4 && <span className="text-[9px] text-gray-500 leading-none">+{chips.length - 4}</span>}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400" /> Feriado</span>
        {Object.entries(TYPE_STYLES).map(([k, s]) => (
          <span key={k} className="flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-sm ${s.dot}`} /> {s.label}</span>
        ))}
        <span>½ = medio día</span>
      </div>

      {/* Selected day details */}
      {selected && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-2" aria-live="polite">
          <h4 className="text-sm font-semibold text-gray-700 capitalize">{format(localDate(selected), "EEEE d 'de' MMMM yyyy", { locale: es })}</h4>
          {!selectedData || (selectedData.holidays.length === 0 && selectedData.absences.length === 0) ? (
            <p className="text-sm text-gray-400">Sin feriados ni ausencias.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {selectedData.holidays.map((h) => (
                <li key={`h${h.id}`} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm bg-amber-400 shrink-0" />
                  <span>{flag(h.country)} {h.country} — {h.name}</span>
                </li>
              ))}
              {selectedData.absences.map((a) => (
                <li key={`v${a.vacation.id}`} className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${styleOf(a.vacation.type).dot}`} />
                  <span>
                    <span className="font-medium">{a.name}</span> — {styleOf(a.vacation.type).label}
                    {a.vacation.halfDay ? ' (medio día)' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
