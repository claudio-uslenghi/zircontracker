'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Clock, TrendingUp, FolderKanban, CalendarDays } from 'lucide-react'
import { useIsMobile } from '@/lib/use-is-mobile'
import SearchableSelect from '@/components/ui/SearchableSelect'
import type { Project } from '@/types'

// ─── Types ───────────────────────────────────────────────────────────────────

type ProjectPivot = {
  projectId: number; projectName: string; projectColor: string
  dailyHours: Record<string, number>
  dailyExtraHours: Record<string, number>
  total: number
}
type PivotData = { days: string[]; resources: { projects: ProjectPivot[]; total: number }[] }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatHours(h: number) {
  return h % 1 === 0 ? h.toFixed(0) : h.toFixed(1)
}

function isWeekend(dayKey: string) {
  const dow = new Date(dayKey + 'T12:00:00Z').getUTCDay()
  return dow === 0 || dow === 6
}

function isoDay(d: Date) {
  return d.toISOString().substring(0, 10)
}

function isToday(dayKey: string) {
  return dayKey === isoDay(new Date())
}

// /api/me/* returns a JSON error body on 403/404 — surface it as a query
// error with a clear message instead of silently showing an empty report.
async function fetchMeJson(url: string) {
  const res = await fetch(url)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? 'No se pudieron cargar los datos.')
  return body
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function MiReportePage() {
  const isMobile = useIsMobile()
  const today = new Date()
  const y = today.getFullYear()
  const m = String(today.getMonth() + 1).padStart(2, '0')
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()

  const [projectId, setProjectId] = useState('')
  const [dateFrom, setDateFrom] = useState(`${y}-${m}-01`)
  const [dateTo, setDateTo] = useState(`${y}-${m}-${String(lastDay).padStart(2, '0')}`)

  const { data: projects } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => fetch('/api/projects').then((r) => r.json()),
  })
  const projectOptions = useMemo(
    () => (projects ?? []).map((p) => ({ value: String(p.id), label: p.name })).sort((a, b) => a.label.localeCompare(b.label)),
    [projects]
  )

  const params = new URLSearchParams({
    view: 'pivot',
    ...(projectId && { projectId }),
    ...(dateFrom && { dateFrom }),
    ...(dateTo && { dateTo }),
  })

  const { data: pivotData, isFetching, error } = useQuery<PivotData>({
    queryKey: ['me-time-entries', 'pivot', projectId, dateFrom, dateTo],
    queryFn: () => fetchMeJson(`/api/me/time-entries?${params}`),
    enabled: !!dateFrom && !!dateTo,
    retry: false,
  })

  const days = useMemo(() => pivotData?.days ?? [], [pivotData])
  const projectRows = useMemo(() => pivotData?.resources?.[0]?.projects ?? [], [pivotData])
  const grandTotal = projectRows.reduce((s, p) => s + p.total, 0)

  const dayTotals = useMemo(() => {
    const m = new Map<string, number>()
    for (const day of days) {
      m.set(day, projectRows.reduce((s, p) => s + (p.dailyHours[day] ?? 0) + (p.dailyExtraHours[day] ?? 0), 0))
    }
    return m
  }, [days, projectRows])
  const daysWithHours = days.filter((d) => (dayTotals.get(d) ?? 0) > 0)

  // Mobile: same data as the pivot table, regrouped chronologically (one
  // card per day) instead of one column per day — days with no hours are
  // skipped so a sparse month doesn't turn into a long empty scroll.
  const dayGroups = useMemo(
    () =>
      days
        .map((day) => ({
          day,
          total: dayTotals.get(day) ?? 0,
          entries: projectRows.filter((p) => (p.dailyHours[day] ?? 0) > 0 || (p.dailyExtraHours[day] ?? 0) > 0),
        }))
        .filter((g) => g.entries.length > 0),
    [days, projectRows, dayTotals]
  )

  const CELL_W = isMobile ? 30 : 34
  const NAME_W = isMobile ? 140 : 220
  const TOTAL_W = isMobile ? 48 : 60

  const cellStyle = (day: string): React.CSSProperties => ({
    backgroundColor: isToday(day) ? '#fffbeb' : isWeekend(day) ? '#E5E7EB' : 'white',
    width: CELL_W, minWidth: CELL_W, maxWidth: CELL_W,
    textAlign: 'center', fontSize: 11, padding: '1px 0',
    borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb',
  })

  const resetFilters = () => {
    setProjectId('')
    setDateFrom(`${y}-${m}-01`)
    setDateTo(`${y}-${m}-${String(lastDay).padStart(2, '0')}`)
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-[#3a3a3a]">Mi Reporte</h1>
        <p className="text-sm text-gray-500 mt-1">Tus propias horas por proyecto, agrupadas por día</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Proyecto</label>
          <SearchableSelect
            value={projectId}
            onChange={setProjectId}
            options={projectOptions}
            placeholder="Todos los proyectos"
            className="border border-gray-300 rounded px-2 py-1.5 text-sm min-w-[160px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Desde</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Hasta</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
        </div>
        <button onClick={resetFilters}
          className="text-sm text-gray-500 hover:text-gray-700 border border-gray-300 rounded px-3 py-1.5">
          Limpiar
        </button>
      </div>

      {error ? (
        <div className="bg-amber-50 border border-amber-300 text-amber-800 rounded-lg p-4 text-sm">
          {(error as Error).message}
        </div>
      ) : (
        <>
      {isFetching && <p className="text-xs text-gray-400">Cargando...</p>}

      {/* Summary cards — same visual language as /dashboard. Gives the page
          real content of its own instead of relying on the table to fill
          the space, which used to look sparse with just a handful of rows. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: '#E6F2FA' }}>
            <Clock size={17} style={{ color: '#0170B9' }} />
          </div>
          <div className="min-w-0">
            <p className="text-lg font-bold text-[#3a3a3a] truncate">{formatHours(grandTotal)}</p>
            <p className="text-xs text-gray-500 truncate">Total horas</p>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: '#E6F2FA' }}>
            <TrendingUp size={17} style={{ color: '#0170B9' }} />
          </div>
          <div className="min-w-0">
            <p className="text-lg font-bold text-[#3a3a3a] truncate">
              {daysWithHours.length ? formatHours(grandTotal / daysWithHours.length) : '0'}
            </p>
            <p className="text-xs text-gray-500 truncate">Promedio/día con carga</p>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: '#E6F2FA' }}>
            <FolderKanban size={17} style={{ color: '#0170B9' }} />
          </div>
          <div className="min-w-0">
            <p className="text-lg font-bold text-[#3a3a3a] truncate">{projectRows.length}</p>
            <p className="text-xs text-gray-500 truncate">Proyectos</p>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: '#E6F2FA' }}>
            <CalendarDays size={17} style={{ color: '#0170B9' }} />
          </div>
          <div className="min-w-0">
            <p className="text-lg font-bold text-[#3a3a3a] truncate">{daysWithHours.length}</p>
            <p className="text-xs text-gray-500 truncate">Días con carga</p>
          </div>
        </div>
      </div>

      {isMobile ? (
        /* Mobile: chronological day cards instead of the day-columns pivot —
           no horizontal scrolling, and empty days don't take up space. */
        <div className="space-y-3">
          {dayGroups.length === 0 && !isFetching && (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm">
              No hay horas cargadas con los filtros seleccionados
            </div>
          )}
          {dayGroups.map(({ day, total, entries }) => (
            <div key={day} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className={`flex items-center justify-between px-4 py-2 text-sm font-semibold ${
                isToday(day) ? 'bg-amber-50 text-amber-800' : 'bg-gray-50 text-gray-600'
              }`}>
                <span className="capitalize">{format(new Date(day + 'T12:00:00Z'), "EEEE d 'de' MMMM", { locale: es })}</span>
                <span className="text-[#0170B9]">{formatHours(total)} hs</span>
              </div>
              <div className="divide-y divide-gray-100">
                {entries.map((p) => (
                  <div key={p.projectId} className="flex items-center justify-between px-4 py-2 text-sm gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span style={{
                        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                        backgroundColor: p.projectColor, flexShrink: 0,
                      }} />
                      <span className="truncate">{p.projectName}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-gray-700">{formatHours(p.dailyHours[day] ?? 0)} hs</span>
                      {(p.dailyExtraHours[day] ?? 0) > 0 && (
                        <span className="text-orange-600 text-xs font-semibold ml-1">
                          +{formatHours(p.dailyExtraHours[day])}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
      /* Pivot table — desktop only. No forced height: it hugs its own
         content, with a cap only for genuinely long date ranges. */
      <div className="bg-white rounded-lg border border-gray-200 overflow-auto max-h-[60vh]">
        <table className="border-collapse text-sm" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr style={{ position: 'sticky', top: 0, zIndex: 15 }}>
              <th style={{
                position: 'sticky', left: 0, zIndex: 20,
                backgroundColor: '#0170B9', color: 'white',
                width: NAME_W, minWidth: NAME_W, textAlign: 'left',
                padding: '6px 10px', fontSize: 12, fontWeight: 'bold',
                borderRight: '2px solid #005a94',
              }}>
                Proyecto
              </th>
              {days.map((day) => (
                <th key={day} style={{
                  backgroundColor: isToday(day) ? '#f59e0b' : isWeekend(day) ? '#7a9cbf' : '#0170B9',
                  color: 'white', width: CELL_W, minWidth: CELL_W,
                  textAlign: 'center', fontSize: 11, fontWeight: 'bold',
                  padding: '6px 0', borderRight: '1px solid #005a94',
                }}>
                  {day.substring(8)}
                </th>
              ))}
              <th style={{
                position: 'sticky', right: 0, zIndex: 20,
                backgroundColor: '#005a94', color: 'white',
                width: TOTAL_W, minWidth: TOTAL_W, textAlign: 'right',
                padding: '6px 8px', fontSize: 12, fontWeight: 'bold',
                borderLeft: '2px solid #004f85',
              }}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {projectRows.map((proj) => (
              <tr key={proj.projectId} className="hover:bg-blue-50">
                <td style={{
                  position: 'sticky', left: 0, zIndex: 5,
                  backgroundColor: 'white',
                  borderRight: '2px solid #d1d5db', borderBottom: '1px solid #e5e7eb',
                  padding: '5px 10px', fontSize: 12,
                  width: NAME_W, minWidth: NAME_W,
                }}>
                  <span style={{
                    display: 'inline-block', width: 8, height: 8,
                    borderRadius: '50%', backgroundColor: proj.projectColor,
                    marginRight: 6, verticalAlign: 'middle',
                  }} />
                  {proj.projectName}
                </td>
                {days.map((day) => {
                  const reg = proj.dailyHours[day]
                  const extra = proj.dailyExtraHours[day]
                  return (
                    <td key={day} style={cellStyle(day)}>
                      {reg ? <div style={{ color: '#374151', lineHeight: 1.2 }}>{formatHours(reg)}</div> : null}
                      {extra ? (
                        <div style={{ color: '#ea580c', fontSize: 9, lineHeight: 1.2, fontWeight: 'bold' }}>
                          +{formatHours(extra)}
                        </div>
                      ) : null}
                    </td>
                  )
                })}
                <td style={{
                  position: 'sticky', right: 0, zIndex: 5,
                  backgroundColor: '#F0F4FF', borderLeft: '2px solid #e5e7eb',
                  borderBottom: '1px solid #e5e7eb',
                  textAlign: 'right', padding: '5px 8px',
                  fontWeight: 'bold', color: '#0170B9', fontSize: 12,
                  width: TOTAL_W, minWidth: TOTAL_W,
                }}>
                  {formatHours(proj.total)}
                </td>
              </tr>
            ))}
            {projectRows.length === 0 && !isFetching && (
              <tr>
                <td colSpan={days.length + 2} style={{ textAlign: 'center', padding: '32px', color: '#9ca3af' }}>
                  No hay horas cargadas con los filtros seleccionados
                </td>
              </tr>
            )}
          </tbody>
          {grandTotal > 0 && (
            <tfoot>
              <tr style={{ position: 'sticky', bottom: 0, zIndex: 15 }}>
                <td style={{
                  position: 'sticky', left: 0, zIndex: 20,
                  backgroundColor: '#1e3a5f', color: 'white',
                  padding: '5px 10px', fontWeight: 'bold', fontSize: 12,
                  borderTop: '2px solid #005a94', borderRight: '2px solid #005a94',
                  width: NAME_W, minWidth: NAME_W,
                }}>
                  TOTAL GENERAL
                </td>
                {days.map((day) => {
                  const dayTotal = projectRows.reduce((s, p) => s + (p.dailyHours[day] ?? 0) + (p.dailyExtraHours[day] ?? 0), 0)
                  return (
                    <td key={day} style={{
                      backgroundColor: isWeekend(day) ? '#374151' : '#1e3a5f',
                      color: 'white', fontWeight: 'bold', fontSize: 11,
                      textAlign: 'center', padding: 0,
                      borderTop: '2px solid #005a94', borderRight: '1px solid #2d4a7a',
                      width: CELL_W, minWidth: CELL_W,
                    }}>
                      {dayTotal > 0 ? formatHours(dayTotal) : ''}
                    </td>
                  )
                })}
                <td style={{
                  position: 'sticky', right: 0, zIndex: 20,
                  backgroundColor: '#005a94', color: 'white',
                  textAlign: 'right', padding: '5px 8px',
                  fontWeight: 'bold', fontSize: 13,
                  borderTop: '2px solid #005a94', borderLeft: '2px solid #004f85',
                  width: TOTAL_W, minWidth: TOTAL_W,
                }}>
                  {formatHours(grandTotal)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      )}
      </>
      )}
    </div>
  )
}
