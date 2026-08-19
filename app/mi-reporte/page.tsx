'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useIsMobile } from '@/lib/use-is-mobile'
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

  const days = pivotData?.days ?? []
  const projectRows = pivotData?.resources?.[0]?.projects ?? []
  const grandTotal = projectRows.reduce((s, p) => s + p.total, 0)

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
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm min-w-[160px]">
            <option value="">Todos los proyectos</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
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
      {/* Info bar */}
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{isFetching ? 'Cargando...' : `${projectRows.length} proyectos · ${days.length} días`}</span>
        {grandTotal > 0 && <span className="font-semibold text-[#0170B9]">Total: {formatHours(grandTotal)} hs</span>}
      </div>

      {/* Pivot table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-auto max-h-[700px]">
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
      </>
      )}
    </div>
  )
}
