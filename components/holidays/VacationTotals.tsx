'use client'

import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { countWorkingDays } from '@/lib/date-utils'
import type { Vacation } from '@/types'

interface Props {
  vacations: Vacation[]
}

const VACATION_TYPE = 'Vacation / Day Off'
const BAR_COLOR = '#0170B9'

// Days from a vacation row that overlap a given year, halved for a half-day
// entry — the simple "days taken" reading, not the legal accrual balance
// (that needs hire dates and per-country rules ZirconTracker doesn't have).
function daysInYear(v: Vacation, year: number): number {
  const start = v.startDate.slice(0, 10)
  const end = v.endDate.slice(0, 10)
  const from = start < `${year}-01-01` ? `${year}-01-01` : start
  const to = end > `${year}-12-31` ? `${year}-12-31` : end
  if (from > to) return 0
  const days = countWorkingDays(from, to)
  return v.halfDay ? days / 2 : days
}

function formatDays(n: number) {
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)
}

export default function VacationTotals({ vacations }: Props) {
  const years = useMemo(() => {
    const set = new Set<number>()
    const current = new Date().getFullYear()
    set.add(current)
    for (const v of vacations) {
      set.add(Number(v.startDate.slice(0, 4)))
      set.add(Number(v.endDate.slice(0, 4)))
    }
    return Array.from(set).sort((a, b) => b - a)
  }, [vacations])

  const [year, setYear] = useState(() => new Date().getFullYear())

  const perPersonPerYear = useMemo(() => {
    const map = new Map<number, { name: string; totals: Map<number, number> }>()
    for (const v of vacations) {
      if (v.type !== VACATION_TYPE || !v.resource) continue
      let entry = map.get(v.resourceId)
      if (!entry) {
        entry = { name: v.resource.name.trim(), totals: new Map() }
        map.set(v.resourceId, entry)
      }
      for (const y of years) {
        const days = daysInYear(v, y)
        if (days > 0) entry.totals.set(y, (entry.totals.get(y) ?? 0) + days)
      }
    }
    return Array.from(map.values())
      .filter((p) => Array.from(p.totals.values()).some((n) => n > 0))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [vacations, years])

  const chartData = useMemo(
    () =>
      perPersonPerYear
        .map((p) => ({ name: p.name, dias: Math.round((p.totals.get(year) ?? 0) * 10) / 10 }))
        .filter((d) => d.dias > 0)
        .sort((a, b) => b.dias - a.dias),
    [perPersonPerYear, year]
  )

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h3 className="text-sm font-semibold text-gray-700">Días de vacaciones tomados en {year}</h3>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
            aria-label="Año"
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {chartData.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">Sin vacaciones tomadas en {year}.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 32)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [`${formatDays(Number(v))} días`, 'Vacaciones']} />
              <Bar dataKey="dias" fill={BAR_COLOR} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
        <p className="text-[11px] text-gray-400 mt-2">
          Días hábiles de tipo &quot;Vacation / Day Off&quot; (medio día cuenta 0.5). No incluye enfermedad ni cumpleaños,
          ni el derecho anual/remanente por antigüedad.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#0170B9] text-white">
              <th className="px-4 py-3 text-left sticky left-0 bg-[#0170B9]">Persona</th>
              {years.map((y) => (
                <th key={y} className={`px-4 py-3 text-right ${y === year ? 'bg-[#005a94]' : ''}`}>{y}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {perPersonPerYear.length === 0 ? (
              <tr><td colSpan={years.length + 1} className="text-center py-6 text-gray-400">Sin vacaciones registradas</td></tr>
            ) : (
              perPersonPerYear.map((p) => (
                <tr key={p.name} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium sticky left-0 bg-white">{p.name}</td>
                  {years.map((y) => {
                    const n = p.totals.get(y) ?? 0
                    return (
                      <td key={y} className={`px-4 py-2.5 text-right tabular-nums ${y === year ? 'bg-blue-50 font-semibold text-[#0170B9]' : 'text-gray-600'}`}>
                        {n > 0 ? formatDays(n) : '—'}
                      </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
