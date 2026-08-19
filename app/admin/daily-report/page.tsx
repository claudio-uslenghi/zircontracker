'use client'

import { useState, Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useIsMobile } from '@/lib/use-is-mobile'

// ─── Types ───────────────────────────────────────────────────────────────────

type ProjectPivot = {
  projectId: number; projectName: string; projectColor: string
  dailyHours: Record<string, number>
  dailyExtraHours: Record<string, number>
  total: number
}
type ResourcePivot = {
  resourceId: number; resourceName: string; resourceColor: string
  projects: ProjectPivot[]; dailyTotals: Record<string, number>; total: number
}
type PivotData = { days: string[]; resources: ResourcePivot[] }

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

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DailyReportPage() {
  const isMobile = useIsMobile()
  const today = new Date()
  const y = today.getFullYear()
  const m = String(today.getMonth() + 1).padStart(2, '0')
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()

  const [resourceId, setResourceId] = useState('')
  const [projectId,  setProjectId]  = useState('')
  const [dateFrom,   setDateFrom]   = useState(`${y}-${m}-01`)
  const [dateTo,     setDateTo]     = useState(`${y}-${m}-${String(lastDay).padStart(2, '0')}`)

  const { data: resources } = useQuery({
    queryKey: ['resources'],
    queryFn: () => fetch('/api/resources').then((r) => r.json()),
  })
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => fetch('/api/projects').then((r) => r.json()),
  })

  const params = new URLSearchParams({
    view: 'pivot',
    ...(resourceId && { resourceId }),
    ...(projectId  && { projectId }),
    ...(dateFrom   && { dateFrom }),
    ...(dateTo     && { dateTo }),
  })

  const { data: pivotData, isFetching } = useQuery<PivotData>({
    queryKey: ['time-entries', 'pivot', resourceId, projectId, dateFrom, dateTo],
    queryFn: () => fetch(`/api/time-entries?${params}`).then((r) => r.json()),
    enabled: !!dateFrom && !!dateTo,
  })

  const days            = pivotData?.days ?? []
  const pivotResources  = pivotData?.resources ?? []
  const grandTotal      = pivotResources.reduce((s, r) => s + r.total, 0)

  const CELL_W  = isMobile ? 30 : 34
  const NAME_W  = isMobile ? 140 : 220
  const TOTAL_W = isMobile ? 48 : 60

  const cellStyle = (day: string, base?: string): React.CSSProperties => ({
    backgroundColor: isToday(day) ? '#fffbeb' : isWeekend(day) ? '#E5E7EB' : (base ?? 'white'),
    width: CELL_W, minWidth: CELL_W, maxWidth: CELL_W,
    textAlign: 'center', fontSize: 11, padding: 0,
    borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb',
  })

  const resetFilters = () => {
    setResourceId(''); setProjectId('')
    setDateFrom(`${y}-${m}-01`)
    setDateTo(`${y}-${m}-${String(lastDay).padStart(2, '0')}`)
  }

  function exportCsv() {
    // Collect all unique projects across all resources (preserving first-seen order)
    const projectMap = new Map<number, string>() // projectId → projectName
    for (const res of pivotResources) {
      for (const proj of res.projects) {
        if (!projectMap.has(proj.projectId)) {
          projectMap.set(proj.projectId, proj.projectName)
        }
      }
    }
    const projects = Array.from(projectMap.entries()).sort(([, a], [, b]) => a.localeCompare(b)) // [[id, name], ...]

    // Header row
    const header = ['Recurso', 'Total Horas', ...projects.map(([, name]) => name)]

    // One row per resource
    const rows = pivotResources.map((res) => {
      const projHoursMap = new Map<number, number>()
      for (const proj of res.projects) {
        projHoursMap.set(proj.projectId, proj.total)
      }
      return [
        res.resourceName,
        formatHours(res.total),
        ...projects.map(([id]) => {
          const h = projHoursMap.get(id)
          return h ? formatHours(h) : ''
        }),
      ]
    })

    // Encode as CSV (quote fields that contain commas)
    const escape = (v: string) => (v.includes(',') ? `"${v}"` : v)
    const csv = [header, ...rows]
      .map((row) => row.map(escape).join(','))
      .join('\n')

    // BOM ensures Excel opens UTF-8 correctly; trigger download
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reporte-diario-${dateFrom}-${dateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-[#3a3a3a]">Reporte Diario</h1>
        <p className="text-sm text-gray-500 mt-1">
          Vista pivot de horas por recurso y proyecto agrupadas por día
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Persona</label>
          <select value={resourceId} onChange={(e) => setResourceId(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm min-w-[160px]">
            <option value="">Todas las personas</option>
            {(resources ?? []).map((r: { id: number; name: string }) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Proyecto</label>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm min-w-[160px]">
            <option value="">Todos los proyectos</option>
            {(projects ?? []).map((p: { id: number; name: string }) => (
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

      {/* Info bar */}
      <div className="flex items-center justify-between flex-wrap gap-2 text-sm text-gray-500">
        <span>{isFetching ? 'Cargando...' : `${pivotResources.length} personas · ${days.length} días`}</span>
        <div className="flex items-center gap-3">
          {grandTotal > 0 && <span className="font-semibold text-[#0170B9]">Total: {formatHours(grandTotal)} hs</span>}
          {pivotResources.length > 0 && (
            <button
              onClick={exportCsv}
              className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-[#0170B9] border border-gray-300 hover:border-[#0170B9] rounded px-3 py-1.5 transition-colors"
            >
              <Download size={14} />
              Exportar CSV
            </button>
          )}
        </div>
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
                Recurso / Proyecto
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
            {pivotResources.map((res) => (
              <Fragment key={res.resourceId}>
                {/* Resource header row */}
                <tr style={{ backgroundColor: '#F0F4FF' }}>
                  <td style={{
                    position: 'sticky', left: 0, zIndex: 5,
                    backgroundColor: '#F0F4FF',
                    borderLeft: `3px solid ${res.resourceColor}`,
                    borderRight: '2px solid #d1d5db', borderBottom: '1px solid #c7d2fe',
                    padding: '5px 10px', fontWeight: 'bold', fontSize: 12,
                    width: NAME_W, minWidth: NAME_W,
                  }}>
                    <span style={{ color: res.resourceColor }}>●</span>{' '}
                    {res.resourceName}
                  </td>
                  {days.map((day) => (
                    <td key={day} style={{ ...cellStyle(day, '#F0F4FF'), fontWeight: 'bold', color: '#1e3a5f', borderBottom: '1px solid #c7d2fe' }}>
                      {res.dailyTotals[day] ? formatHours(res.dailyTotals[day]) : ''}
                    </td>
                  ))}
                  <td style={{
                    position: 'sticky', right: 0, zIndex: 5,
                    backgroundColor: '#dbeafe', borderLeft: '2px solid #93c5fd',
                    borderBottom: '1px solid #c7d2fe',
                    textAlign: 'right', padding: '5px 8px',
                    fontWeight: 'bold', color: '#0170B9', fontSize: 12,
                    width: TOTAL_W, minWidth: TOTAL_W,
                  }}>
                    {formatHours(res.total)}
                  </td>
                </tr>
                {/* Project rows */}
                {res.projects.map((proj) => (
                  <tr key={proj.projectId} className="hover:bg-blue-50">
                    <td style={{
                      position: 'sticky', left: 0, zIndex: 5,
                      backgroundColor: 'white',
                      borderRight: '2px solid #d1d5db', borderBottom: '1px solid #e5e7eb',
                      padding: '3px 10px 3px 22px',
                      width: NAME_W, minWidth: NAME_W, fontSize: 11,
                    }}>
                      <span style={{
                        display: 'inline-block', width: 8, height: 8,
                        borderRadius: '50%', backgroundColor: proj.projectColor,
                        marginRight: 5, verticalAlign: 'middle',
                      }} />
                      {proj.projectName}
                    </td>
                    {days.map((day) => {
                      const reg   = proj.dailyHours[day]
                      const extra = proj.dailyExtraHours[day]
                      return (
                        <td key={day} style={{ ...cellStyle(day), padding: '1px 0' }}>
                          {reg ? (
                            <div style={{ color: '#374151', lineHeight: 1.2 }}>{formatHours(reg)}</div>
                          ) : null}
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
                      backgroundColor: 'white', borderLeft: '2px solid #e5e7eb',
                      borderBottom: '1px solid #e5e7eb',
                      textAlign: 'right', padding: '3px 8px',
                      color: '#6b7280', fontSize: 11,
                      width: TOTAL_W, minWidth: TOTAL_W,
                    }}>
                      {formatHours(proj.total)}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {pivotResources.length === 0 && !isFetching && (
              <tr>
                <td colSpan={days.length + 2} style={{ textAlign: 'center', padding: '32px', color: '#9ca3af' }}>
                  No hay datos con los filtros seleccionados
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
                  const dayTotal = pivotResources.reduce((s, r) => s + (r.dailyTotals[day] ?? 0), 0)
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
    </div>
  )
}
