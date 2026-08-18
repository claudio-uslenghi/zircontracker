'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { startOfWeek, addDays, addWeeks, format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import type { Task, TimeEntry, Project } from '@/types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatHours(h: number) {
  return h % 1 === 0 ? h.toFixed(0) : h.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function isoDay(d: Date) {
  return format(d, 'yyyy-MM-dd')
}

function weekDays(mondayIso: string) {
  const monday = parseISO(mondayIso)
  return Array.from({ length: 7 }, (_, i) => isoDay(addDays(monday, i)))
}

const DAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

// Stable reference so the tmEntries useEffect below doesn't re-fire every
// render — a fresh `[]` default from useQuery would otherwise loop forever.
const EMPTY_ENTRIES: TimeEntry[] = []

function isWeekendDay(dayKey: string) {
  const dow = parseISO(dayKey).getDay()
  return dow === 0 || dow === 6
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function MisHorasPage() {
  const qc = useQueryClient()
  const today = new Date()
  const [mode, setMode] = useState<'detailed' | 'tm'>('detailed')
  const [weekStart, setWeekStart] = useState(isoDay(startOfWeek(today, { weekStartsOn: 1 })))
  const [projectId, setProjectId] = useState('')
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([])
  const [addTaskId, setAddTaskId] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  const [tmYm, setTmYm] = useState(format(today, 'yyyy-MM'))
  const [tmDefaultHours, setTmDefaultHours] = useState(8)
  const [tmDayValues, setTmDayValues] = useState<Record<number, number>>({})
  const [tmSaving, setTmSaving] = useState(false)
  const [tmSavedMsg, setTmSavedMsg] = useState('')

  const days = weekDays(weekStart)

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => fetch('/api/projects').then((r) => r.json()),
  })

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ['tasks', projectId],
    queryFn: () => fetch(`/api/tasks?projectId=${projectId}`).then((r) => r.json()),
    enabled: !!projectId,
  })

  const { data: entries = [], isFetching } = useQuery<TimeEntry[]>({
    queryKey: ['me-time-entries', projectId, weekStart],
    queryFn: () =>
      fetch(`/api/me/time-entries?projectId=${projectId}&dateFrom=${days[0]}&dateTo=${days[6]}`).then((r) => r.json()),
    enabled: !!projectId,
  })

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])

  const grid = useMemo(() => {
    const m = new Map<number, Record<string, number>>()
    for (const e of entries) {
      if (e.taskId == null) continue
      const day = e.date.substring(0, 10)
      if (!m.has(e.taskId)) m.set(e.taskId, {})
      m.get(e.taskId)![day] = e.hours
    }
    return m
  }, [entries])

  // Rows shown = tasks explicitly added this session ∪ any task with hours this week
  const rowTaskIds = useMemo(() => {
    const s = new Set(selectedTaskIds)
    for (const e of entries) if (e.taskId != null) s.add(e.taskId)
    return Array.from(s).filter((id) => taskById.has(id) || grid.has(id))
  }, [selectedTaskIds, entries, taskById, grid])

  const availableTasksToAdd = tasks.filter((t) => t.active && !rowTaskIds.includes(t.id))

  const weekTotal = rowTaskIds.reduce((sum, taskId) => {
    const row = grid.get(taskId) ?? {}
    return sum + days.reduce((s, d) => s + (row[d] ?? 0), 0)
  }, 0)

  function addRow() {
    if (!addTaskId) return
    setSelectedTaskIds((prev) => [...prev, Number(addTaskId)])
    setAddTaskId('')
  }

  function removeRow(taskId: number) {
    setSelectedTaskIds((prev) => prev.filter((id) => id !== taskId))
  }

  async function saveCell(taskId: number, day: string, hours: number) {
    await fetch('/api/me/time-entries', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: Number(projectId), taskId, date: `${day}T12:00:00.000Z`, hours }),
    })
    await qc.invalidateQueries({ queryKey: ['me-time-entries', projectId, weekStart] })
    setRefreshKey((k) => k + 1)
  }

  // ─── T&M bulk mode ─────────────────────────────────────────────────────────

  const [tmYear, tmMonth] = tmYm.split('-').map(Number)
  const tmDaysInMonth = new Date(tmYear, tmMonth, 0).getDate()
  const tmMonthStart = `${tmYm}-01`
  const tmMonthEnd = `${tmYm}-${String(tmDaysInMonth).padStart(2, '0')}`

  const tmBusinessDays = useMemo(() => {
    const list: number[] = []
    for (let d = 1; d <= tmDaysInMonth; d++) {
      const dow = new Date(tmYear, tmMonth - 1, d).getDay()
      if (dow !== 0 && dow !== 6) list.push(d)
    }
    return list
  }, [tmYear, tmMonth, tmDaysInMonth])

  const { data: tmEntries = EMPTY_ENTRIES, dataUpdatedAt: tmEntriesUpdatedAt } = useQuery<TimeEntry[]>({
    queryKey: ['me-time-entries-tm', projectId, tmYm],
    queryFn: () =>
      fetch(`/api/me/time-entries?projectId=${projectId}&dateFrom=${tmMonthStart}&dateTo=${tmMonthEnd}`).then((r) => r.json()),
    enabled: !!projectId && mode === 'tm',
  })

  // Seed the editable day values from whatever's already saved for this
  // project/month; days with no saved entry default to tmDefaultHours.
  // Keyed off dataUpdatedAt (not the tmEntries array itself) so this only
  // re-runs when the query actually resolves new data, not on every render.
  useEffect(() => {
    const fromEntries: Record<number, number> = {}
    for (const e of tmEntries) {
      if (e.taskId != null) continue
      fromEntries[Number(e.date.substring(8, 10))] = e.hours
    }
    const initial: Record<number, number> = {}
    for (const d of tmBusinessDays) initial[d] = fromEntries[d] ?? tmDefaultHours
    setTmDayValues(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, tmYm, tmEntriesUpdatedAt])

  function applyDefaultToAllDays() {
    const next: Record<number, number> = {}
    for (const d of tmBusinessDays) next[d] = tmDefaultHours
    setTmDayValues(next)
  }

  const tmMonthTotal = tmBusinessDays.reduce((s, d) => s + (tmDayValues[d] ?? 0), 0)

  async function saveTmMonth() {
    setTmSaving(true)
    setTmSavedMsg('')
    try {
      const res = await fetch('/api/me/time-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: Number(projectId),
          year: tmYear,
          month: tmMonth,
          defaultHours: tmDefaultHours,
          overrides: tmDayValues,
        }),
      })
      const json = await res.json()
      setTmSavedMsg(res.ok ? `Guardado: ${json.saved} días` : (json.error ?? 'Error al guardar'))
      qc.invalidateQueries({ queryKey: ['me-time-entries-tm', projectId, tmYm] })
    } finally {
      setTmSaving(false)
    }
  }

  const CELL_W = 70
  const NAME_W = 240
  const TOTAL_W = 70

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#3a3a3a]">Mis Horas</h1>
        <p className="text-sm text-gray-500 mt-1">Cargá tus horas por tarea, semana a semana</p>
      </div>

      {/* Mode toggle */}
      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
        <button
          onClick={() => setMode('detailed')}
          className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
            mode === 'detailed' ? 'bg-[#0170B9] text-white' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Detallado (por tarea)
        </button>
        <button
          onClick={() => setMode('tm')}
          className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
            mode === 'tm' ? 'bg-[#0170B9] text-white' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Time &amp; Material (mensual)
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Proyecto</label>
          <select
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value)
              setSelectedTaskIds([])
            }}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm min-w-[220px]"
          >
            <option value="">Seleccionar proyecto...</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        {mode === 'detailed' ? (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Semana</label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setWeekStart((w) => isoDay(addWeeks(parseISO(w), -1)))}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm hover:bg-gray-50"
              >
                ← Anterior
              </button>
              <span className="text-sm text-gray-600 px-1">
                {format(parseISO(days[0]), "d 'de' MMM", { locale: es })} – {format(parseISO(days[6]), "d 'de' MMM yyyy", { locale: es })}
              </span>
              <button
                onClick={() => setWeekStart((w) => isoDay(addWeeks(parseISO(w), 1)))}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm hover:bg-gray-50"
              >
                Siguiente →
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Mes</label>
              <input
                type="month"
                value={tmYm}
                onChange={(e) => setTmYm(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Horas por defecto (días hábiles)</label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={tmDefaultHours}
                onChange={(e) => setTmDefaultHours(Number(e.target.value))}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-28"
              />
            </div>
            <button
              onClick={applyDefaultToAllDays}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Aplicar a todos los días
            </button>
          </>
        )}
      </div>

      {!projectId ? (
        <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-400 text-sm">
          Elegí un proyecto para empezar a cargar horas.
        </div>
      ) : mode === 'tm' ? (
        <>
          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>{tmBusinessDays.length} días hábiles en {format(new Date(tmYear, tmMonth - 1, 1), 'MMMM yyyy', { locale: es })}</span>
            <span className="font-semibold text-[#0170B9]">Total mes: {formatHours(tmMonthTotal)} hs</span>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
            {tmBusinessDays.map((d) => {
              const date = new Date(tmYear, tmMonth - 1, d)
              return (
                <div key={d} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="text-gray-600 capitalize">{format(date, "EEEE d 'de' MMMM", { locale: es })}</span>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    value={tmDayValues[d] ?? ''}
                    onChange={(e) => setTmDayValues((prev) => ({ ...prev, [d]: Number(e.target.value) }))}
                    className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-center"
                  />
                </div>
              )
            })}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={saveTmMonth}
              disabled={tmSaving}
              className="px-4 py-2 bg-[#0170B9] text-white rounded text-sm hover:bg-[#005a94] disabled:opacity-50"
            >
              {tmSaving ? 'Guardando...' : 'Guardar mes'}
            </button>
            {tmSavedMsg && <span className="text-sm text-gray-500">{tmSavedMsg}</span>}
          </div>
        </>
      ) : (
        <>
          {/* Add task row */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Agregar tarea a la grilla</label>
              <select
                value={addTaskId}
                onChange={(e) => setAddTaskId(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm min-w-[220px]"
              >
                <option value="">Seleccionar tarea...</option>
                {availableTasksToAdd.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <button
              onClick={addRow}
              disabled={!addTaskId}
              className="px-3 py-1.5 bg-[#0170B9] text-white rounded text-sm hover:bg-[#005a94] disabled:opacity-40"
            >
              + Agregar
            </button>
            {tasks.length === 0 && (
              <span className="text-xs text-gray-400">Este proyecto todavía no tiene tareas cargadas por el admin.</span>
            )}
          </div>

          {/* Info bar */}
          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>{isFetching ? 'Cargando...' : `${rowTaskIds.length} tareas esta semana`}</span>
            {weekTotal > 0 && <span className="font-semibold text-[#0170B9]">Total semana: {formatHours(weekTotal)} hs</span>}
          </div>

          {/* Grid */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-auto">
            <table className="border-collapse text-sm" style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={{
                    position: 'sticky', left: 0, zIndex: 10,
                    backgroundColor: '#0170B9', color: 'white',
                    width: NAME_W, minWidth: NAME_W, textAlign: 'left',
                    padding: '8px 10px', fontSize: 12, fontWeight: 'bold',
                    borderRight: '2px solid #005a94',
                  }}>
                    Tarea
                  </th>
                  {days.map((day, i) => (
                    <th key={day} style={{
                      backgroundColor: isWeekendDay(day) ? '#7a9cbf' : '#0170B9',
                      color: 'white', width: CELL_W, minWidth: CELL_W,
                      textAlign: 'center', fontSize: 11, fontWeight: 'bold',
                      padding: '8px 4px', borderRight: '1px solid #005a94',
                    }}>
                      <div>{DAY_LABELS[i]}</div>
                      <div style={{ fontWeight: 'normal', opacity: 0.85 }}>{day.substring(8)}</div>
                    </th>
                  ))}
                  <th style={{
                    backgroundColor: '#005a94', color: 'white',
                    width: TOTAL_W, minWidth: TOTAL_W, textAlign: 'right',
                    padding: '8px 10px', fontSize: 12, fontWeight: 'bold',
                    borderLeft: '2px solid #004f85',
                  }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {rowTaskIds.map((taskId) => {
                  const task = taskById.get(taskId)
                  const row = grid.get(taskId) ?? {}
                  const rowTotal = days.reduce((s, d) => s + (row[d] ?? 0), 0)
                  return (
                    <tr key={taskId} className="hover:bg-blue-50">
                      <td style={{
                        position: 'sticky', left: 0, zIndex: 5,
                        backgroundColor: 'white',
                        borderRight: '2px solid #d1d5db', borderBottom: '1px solid #e5e7eb',
                        padding: '6px 10px', fontSize: 12,
                        width: NAME_W, minWidth: NAME_W,
                      }}>
                        <div className="flex items-center justify-between gap-2">
                          <span>{task?.name ?? `Tarea #${taskId}`}</span>
                          {!Object.keys(row).some((d) => row[d] > 0) && (
                            <button
                              onClick={() => removeRow(taskId)}
                              className="text-gray-300 hover:text-red-500 text-xs"
                              title="Quitar de la grilla"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </td>
                      {days.map((day) => (
                        <td key={`${taskId}-${day}-${refreshKey}`} style={{
                          backgroundColor: isWeekendDay(day) ? '#F3F4F6' : 'white',
                          width: CELL_W, minWidth: CELL_W,
                          borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb',
                          padding: 2,
                        }}>
                          <input
                            type="number"
                            step="0.25"
                            min="0"
                            defaultValue={row[day] ?? ''}
                            onBlur={(e) => {
                              const val = e.target.value === '' ? 0 : Number(e.target.value)
                              if (val === (row[day] ?? 0)) return
                              saveCell(taskId, day, val)
                            }}
                            className="w-full text-center text-sm border-0 bg-transparent focus:bg-blue-50 focus:outline-none rounded py-1"
                          />
                        </td>
                      ))}
                      <td style={{
                        backgroundColor: '#F0F4FF', borderLeft: '2px solid #e5e7eb',
                        borderBottom: '1px solid #e5e7eb',
                        textAlign: 'right', padding: '6px 10px',
                        fontWeight: 'bold', color: '#0170B9', fontSize: 12,
                        width: TOTAL_W, minWidth: TOTAL_W,
                      }}>
                        {rowTotal > 0 ? formatHours(rowTotal) : ''}
                      </td>
                    </tr>
                  )
                })}
                {rowTaskIds.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '32px', color: '#9ca3af' }}>
                      Agregá una tarea arriba para empezar a cargar horas esta semana
                    </td>
                  </tr>
                )}
              </tbody>
              {rowTaskIds.length > 0 && (
                <tfoot>
                  <tr>
                    <td style={{
                      position: 'sticky', left: 0, zIndex: 5,
                      backgroundColor: '#1e3a5f', color: 'white',
                      padding: '6px 10px', fontWeight: 'bold', fontSize: 12,
                      borderTop: '2px solid #005a94',
                      width: NAME_W, minWidth: NAME_W,
                    }}>
                      Total del día
                    </td>
                    {days.map((day) => {
                      const dayTotal = rowTaskIds.reduce((s, id) => s + ((grid.get(id) ?? {})[day] ?? 0), 0)
                      return (
                        <td key={day} style={{
                          backgroundColor: isWeekendDay(day) ? '#374151' : '#1e3a5f',
                          color: 'white', fontWeight: 'bold', fontSize: 11,
                          textAlign: 'center', padding: '6px 0',
                          borderTop: '2px solid #005a94',
                          width: CELL_W, minWidth: CELL_W,
                        }}>
                          {dayTotal > 0 ? formatHours(dayTotal) : ''}
                        </td>
                      )
                    })}
                    <td style={{
                      backgroundColor: '#005a94', color: 'white',
                      textAlign: 'right', padding: '6px 10px',
                      fontWeight: 'bold', fontSize: 13,
                      borderTop: '2px solid #005a94',
                      width: TOTAL_W, minWidth: TOTAL_W,
                    }}>
                      {formatHours(weekTotal)}
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
