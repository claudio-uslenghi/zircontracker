'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { startOfWeek, addDays, addWeeks, format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Plus, Trash2, Clock, FolderKanban, ListChecks } from 'lucide-react'
import { useIsMobile } from '@/lib/use-is-mobile'
import SearchableSelect from '@/components/ui/SearchableSelect'
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

function isToday(dayKey: string) {
  return dayKey === isoDay(new Date())
}

// Row identity in Detallado mode is (project, task) — task is nullable
// because T&M entries have no task, and they now show up here too, so a
// bare taskId can't identify a row on its own (two different projects could
// each have a "no task" row).
function rowKey(projectId: number, taskId: number | null) {
  return `${projectId}:${taskId ?? 'none'}`
}
function parseRowKey(key: string): { projectId: number; taskId: number | null } {
  const [projectId, taskId] = key.split(':')
  return { projectId: Number(projectId), taskId: taskId === 'none' ? null : Number(taskId) }
}

// /api/me/* returns a JSON error body (not an array) on 403/404 — surface it
// as a query error instead of letting downstream array methods crash the page.
async function fetchMeJson(url: string) {
  const res = await fetch(url)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? 'No se pudieron cargar los datos.')
  return body
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function MisHorasPage() {
  const qc = useQueryClient()
  const isMobile = useIsMobile()
  const today = new Date()
  const [mode, setMode] = useState<'detailed' | 'tm'>('detailed')
  const [weekStart, setWeekStart] = useState(isoDay(startOfWeek(today, { weekStartsOn: 1 })))
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])
  const [pickerProjectId, setPickerProjectId] = useState('')
  const [pickerTaskId, setPickerTaskId] = useState('')
  const [newTaskName, setNewTaskName] = useState('')
  const [creatingTask, setCreatingTask] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const [tmProjectId, setTmProjectId] = useState('')
  const [tmYm, setTmYm] = useState(format(today, 'yyyy-MM'))
  const [tmDefaultHours, setTmDefaultHours] = useState(8)
  const [tmDayValues, setTmDayValues] = useState<Record<number, number>>({})
  const [tmSaving, setTmSaving] = useState(false)
  const [tmSavedMsg, setTmSavedMsg] = useState('')
  const [tmDeleting, setTmDeleting] = useState(false)

  // Mobile Detallado view shows one day at a time — defaults to today when
  // it falls inside the visible week, otherwise Monday.
  const [selectedDayIndex, setSelectedDayIndex] = useState(0)

  const days = weekDays(weekStart)

  useEffect(() => {
    const todayIndex = days.indexOf(isoDay(new Date()))
    setSelectedDayIndex(todayIndex >= 0 ? todayIndex : 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart])

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => fetch('/api/projects').then((r) => r.json()),
  })

  // All tasks across every project — needed to label rows ("Proyecto: Tarea")
  // regardless of which project each row belongs to, and to populate the
  // row-picker's task dropdown once a project is chosen there.
  const { data: allTasks = [] } = useQuery<Task[]>({
    queryKey: ['tasks'],
    queryFn: () => fetch('/api/tasks').then((r) => r.json()),
  })

  // Detailed mode: every entry for the visible week, across all projects —
  // each row picks its own project+task, so there's nothing to filter by here.
  const { data: entries = [], isFetching, error: entriesError } = useQuery<TimeEntry[]>({
    queryKey: ['me-time-entries', weekStart],
    queryFn: () => fetchMeJson(`/api/me/time-entries?dateFrom=${days[0]}&dateTo=${days[6]}`),
    enabled: mode === 'detailed',
    retry: false,
  })

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const projectOptions = useMemo(
    () => projects.filter((p) => p.status !== 'Finalizado').map((p) => ({ value: String(p.id), label: p.name })).sort((a, b) => a.label.localeCompare(b.label)),
    [projects]
  )
  const taskById = useMemo(() => new Map(allTasks.map((t) => [t.id, t])), [allTasks])

  // Keyed by (projectId, taskId) — includes T&M entries (taskId: null) too,
  // so hours loaded from the T&M tab show up and are editable here as well.
  const grid = useMemo(() => {
    const m = new Map<string, Record<string, number>>()
    for (const e of entries) {
      const key = rowKey(e.projectId, e.taskId)
      const day = e.date.substring(0, 10)
      if (!m.has(key)) m.set(key, {})
      m.get(key)![day] = e.hours
    }
    return m
  }, [entries])

  // Rows shown = rows explicitly added this session ∪ any (project, task) with hours this week
  const rowKeys = useMemo(() => {
    const s = new Set(selectedRowKeys)
    for (const e of entries) s.add(rowKey(e.projectId, e.taskId))
    return Array.from(s).filter((key) => {
      const { projectId, taskId } = parseRowKey(key)
      if (!projectById.has(projectId)) return false
      if (taskId == null) return true
      return taskById.has(taskId) || grid.has(key)
    })
  }, [selectedRowKeys, entries, projectById, taskById, grid])

  function rowLabel(key: string) {
    const { projectId, taskId } = parseRowKey(key)
    const projectName = projectById.get(projectId)?.name ?? `Proyecto #${projectId}`
    if (taskId == null) return `${projectName}: Sin tarea (T&M)`
    const task = taskById.get(taskId)
    return `${projectName}: ${task?.name ?? `Tarea #${taskId}`}`
  }

  function rowColor(key: string) {
    const { projectId } = parseRowKey(key)
    return projectById.get(projectId)?.color ?? '#9ca3af'
  }

  const pickerTaskOptions = useMemo(
    () => allTasks.filter((t) => t.active && String(t.projectId) === pickerProjectId && !rowKeys.includes(rowKey(t.projectId, t.id))),
    [allTasks, pickerProjectId, rowKeys]
  )
  const pickerNoTaskAlreadyAdded = pickerProjectId ? rowKeys.includes(rowKey(Number(pickerProjectId), null)) : false

  const weekTotal = rowKeys.reduce((sum, key) => {
    const row = grid.get(key) ?? {}
    return sum + days.reduce((s, d) => s + (row[d] ?? 0), 0)
  }, 0)
  const weekProjectCount = useMemo(() => new Set(rowKeys.map((k) => parseRowKey(k).projectId)).size, [rowKeys])
  const weekTaskCount = useMemo(() => rowKeys.filter((k) => parseRowKey(k).taskId != null).length, [rowKeys])

  function addRow() {
    if (!pickerProjectId || !pickerTaskId || pickerTaskId === '__new__') return
    const taskId = pickerTaskId === '__none__' ? null : Number(pickerTaskId)
    setSelectedRowKeys((prev) => [...prev, rowKey(Number(pickerProjectId), taskId)])
    setPickerProjectId('')
    setPickerTaskId('')
  }

  async function createTask() {
    if (!pickerProjectId || !newTaskName.trim()) return
    setCreatingTask(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: Number(pickerProjectId), name: newTaskName.trim() }),
      })
      const task = await res.json()
      if (res.ok) {
        await qc.invalidateQueries({ queryKey: ['tasks'] })
        setPickerTaskId(String(task.id))
        setNewTaskName('')
      }
    } finally {
      setCreatingTask(false)
    }
  }

  async function removeRow(key: string) {
    const { projectId, taskId } = parseRowKey(key)
    const row = grid.get(key) ?? {}
    const hasHours = Object.values(row).some((h) => h > 0)
    if (hasHours) {
      if (!confirm(`¿Eliminar "${rowLabel(key)}"? Se van a borrar las horas cargadas esta semana para esta fila.`)) return
      const idsToDelete = entries.filter((e) => e.projectId === projectId && e.taskId === taskId).map((e) => e.id)
      await Promise.all(idsToDelete.map((id) => fetch(`/api/me/time-entries?id=${id}`, { method: 'DELETE' })))
      await qc.invalidateQueries({ queryKey: ['me-time-entries', weekStart] })
    }
    setSelectedRowKeys((prev) => prev.filter((k) => k !== key))
  }

  async function saveCell(projectId: number, taskId: number | null, day: string, hours: number) {
    await fetch('/api/me/time-entries', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, taskId, date: `${day}T12:00:00.000Z`, hours }),
    })
    await qc.invalidateQueries({ queryKey: ['me-time-entries', weekStart] })
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

  const { data: tmEntries = EMPTY_ENTRIES, dataUpdatedAt: tmEntriesUpdatedAt, error: tmEntriesError } = useQuery<TimeEntry[]>({
    queryKey: ['me-time-entries-tm', tmProjectId, tmYm],
    queryFn: () => fetchMeJson(`/api/me/time-entries?projectId=${tmProjectId}&dateFrom=${tmMonthStart}&dateTo=${tmMonthEnd}`),
    enabled: !!tmProjectId && mode === 'tm',
    retry: false,
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
  }, [tmProjectId, tmYm, tmEntriesUpdatedAt])

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
          projectId: Number(tmProjectId),
          year: tmYear,
          month: tmMonth,
          defaultHours: tmDefaultHours,
          overrides: tmDayValues,
        }),
      })
      const json = await res.json()
      setTmSavedMsg(res.ok ? `Guardado: ${json.saved} días` : (json.error ?? 'Error al guardar'))
      qc.invalidateQueries({ queryKey: ['me-time-entries-tm', tmProjectId, tmYm] })
    } finally {
      setTmSaving(false)
    }
  }

  async function deleteTmMonth() {
    const projectName = projectById.get(Number(tmProjectId))?.name ?? 'este proyecto'
    const monthLabel = format(new Date(tmYear, tmMonth - 1, 1), 'MMMM yyyy', { locale: es })
    if (!confirm(`¿Borrar TODAS las horas de "${projectName}" cargadas en ${monthLabel}? Esta acción no se puede deshacer.`)) return
    setTmDeleting(true)
    setTmSavedMsg('')
    try {
      const res = await fetch(`/api/me/time-entries?projectId=${tmProjectId}&month=${tmYm}`, { method: 'DELETE' })
      const json = await res.json()
      setTmSavedMsg(res.ok ? `Borradas ${json.deleted} entradas de ${monthLabel}` : (json.error ?? 'Error al borrar'))
      qc.invalidateQueries({ queryKey: ['me-time-entries-tm', tmProjectId, tmYm] })
    } finally {
      setTmDeleting(false)
    }
  }

  // Column sizing shrinks on mobile so the fixed name column doesn't eat the
  // whole viewport, leaving the day columns scrollable but reachable.
  const CELL_W = isMobile ? 52 : 70
  const NAME_W = isMobile ? 150 : 240
  const TOTAL_W = isMobile ? 52 : 70
  const inputFontSize = isMobile ? 16 : 14 // ≥16px so iOS doesn't auto-zoom on focus

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-[#3a3a3a]">Mis Horas</h1>
        <p className="text-sm text-gray-500 mt-1">Cargá tus horas por tarea, semana a semana</p>
      </div>

      {/* Mode toggle */}
      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
        <button
          onClick={() => setMode('detailed')}
          className={`px-3 sm:px-4 py-1.5 rounded text-sm font-medium transition-colors ${
            mode === 'detailed' ? 'bg-[#0170B9] text-white' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Detallado
        </button>
        <button
          onClick={() => setMode('tm')}
          className={`px-3 sm:px-4 py-1.5 rounded text-sm font-medium transition-colors ${
            mode === 'tm' ? 'bg-[#0170B9] text-white' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Time &amp; Material
        </button>
      </div>

      {mode === 'detailed' ? (
        <>
          {/* Week nav */}
          <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 flex flex-wrap items-center gap-2 sm:gap-3">
            <button
              onClick={() => setWeekStart((w) => isoDay(addWeeks(parseISO(w), -1)))}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm hover:bg-gray-50"
            >
              ←
            </button>
            <span className="text-sm text-gray-600 flex-1 text-center sm:flex-initial">
              {format(parseISO(days[0]), "d 'de' MMM", { locale: es })} – {format(parseISO(days[6]), "d 'de' MMM yyyy", { locale: es })}
            </span>
            <button
              onClick={() => setWeekStart((w) => isoDay(addWeeks(parseISO(w), 1)))}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm hover:bg-gray-50"
            >
              →
            </button>
            {weekTotal > 0 && (
              <span className="ml-auto font-semibold text-[#0170B9] text-sm">Total: {formatHours(weekTotal)} hs</span>
            )}
          </div>

          {/* Summary cards — same visual language as Mi Reporte/Dashboard.
              Gives the page real content so the table doesn't feel like it's
              floating in a mostly-empty card on wide screens. */}
          {!entriesError && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: '#E6F2FA' }}>
                  <Clock size={17} style={{ color: '#0170B9' }} />
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-bold text-[#3a3a3a] truncate">{formatHours(weekTotal)}</p>
                  <p className="text-xs text-gray-500 truncate">Horas semana</p>
                </div>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: '#E6F2FA' }}>
                  <FolderKanban size={17} style={{ color: '#0170B9' }} />
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-bold text-[#3a3a3a] truncate">{weekProjectCount}</p>
                  <p className="text-xs text-gray-500 truncate">Proyectos</p>
                </div>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: '#E6F2FA' }}>
                  <ListChecks size={17} style={{ color: '#0170B9' }} />
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-bold text-[#3a3a3a] truncate">{weekTaskCount}</p>
                  <p className="text-xs text-gray-500 truncate">Tareas cargadas</p>
                </div>
              </div>
            </div>
          )}

          {/* Day picker — mobile only. Desktop shows every day at once as
              grid columns, so this selector has nothing to do there. */}
          {isMobile && (
            <div className="grid grid-cols-7 gap-1">
              {days.map((day, i) => (
                <button
                  key={day}
                  onClick={() => setSelectedDayIndex(i)}
                  className={`flex flex-col items-center justify-center rounded-lg py-2 text-xs font-medium transition-colors ${
                    i === selectedDayIndex
                      ? 'bg-[#0170B9] text-white'
                      : isToday(day)
                      ? 'bg-amber-50 text-amber-700 border border-amber-300'
                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <span>{DAY_LABELS[i]}</span>
                  <span className="text-[10px] opacity-80">{day.substring(8)}</span>
                </button>
              ))}
            </div>
          )}

          {entriesError ? (
            <div className="bg-amber-50 border border-amber-300 text-amber-800 rounded-lg p-4 text-sm">
              {entriesError.message}
            </div>
          ) : isMobile ? (
            <>
              {/* Mobile: one day at a time — a vertical list of tasks with a
                  single hour input each, instead of the 7-column grid, so
                  there's no horizontal scrolling and tap targets stay full-width. */}
              <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                {isFetching && rowKeys.length === 0 && (
                  <div className="text-center text-gray-400 text-sm py-6">Cargando...</div>
                )}
                {!isFetching && rowKeys.length === 0 && (
                  <div className="text-center text-gray-400 text-sm py-6">Todavía no agregaste tareas esta semana.</div>
                )}
                {rowKeys.map((key) => {
                  const { projectId, taskId } = parseRowKey(key)
                  const row = grid.get(key) ?? {}
                  const selectedDay = days[selectedDayIndex]
                  return (
                    <div key={key} className="flex items-center gap-3 px-4 py-3">
                      <span style={{
                        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                        backgroundColor: rowColor(key), flexShrink: 0,
                      }} />
                      <span className="flex-1 min-w-0 truncate text-sm">{rowLabel(key)}</span>
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        defaultValue={row[selectedDay] ?? ''}
                        onBlur={(e) => {
                          const val = e.target.value === '' ? 0 : Number(e.target.value)
                          if (val === (row[selectedDay] ?? 0)) return
                          saveCell(projectId, taskId, selectedDay, val)
                        }}
                        key={`${key}-${selectedDay}-${refreshKey}`}
                        style={{ fontSize: 16 }}
                        className="w-20 border border-gray-300 rounded px-2 py-2 text-center focus:bg-blue-50 focus:outline-none focus:border-[#0170B9]"
                      />
                      <button
                        onClick={() => removeRow(key)}
                        className="text-red-400 hover:text-red-600 transition-colors p-1"
                        title="Eliminar fila"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )
                })}
                {rowKeys.length > 0 && (
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50 font-semibold text-sm">
                    <span className="text-gray-600">Total del día</span>
                    <span className="text-[#0170B9]">
                      {formatHours(rowKeys.reduce((s, k) => s + ((grid.get(k) ?? {})[days[selectedDayIndex]] ?? 0), 0))} hs
                    </span>
                  </div>
                )}
              </div>

              {/* Add-task picker — same fields as desktop's inline row, just
                  stacked full-width instead of squeezed into a narrow cell. */}
              <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <Plus size={13} className="text-[#0170B9] shrink-0" />
                  Agregar tarea
                </div>
                <SearchableSelect
                  value={pickerProjectId}
                  onChange={(v) => { setPickerProjectId(v); setPickerTaskId(''); setNewTaskName('') }}
                  options={projectOptions}
                  placeholder="Proyecto..."
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                />
                <select
                  value={pickerTaskId}
                  onChange={(e) => setPickerTaskId(e.target.value)}
                  disabled={!pickerProjectId}
                  style={{ fontSize: 16 }}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm disabled:bg-gray-100"
                >
                  <option value="">Tarea...</option>
                  {!pickerNoTaskAlreadyAdded && <option value="__none__">Sin tarea (Time & Material)</option>}
                  {pickerTaskOptions.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                  <option value="__new__">+ Crear tarea nueva...</option>
                </select>
                {pickerTaskId === '__new__' && (
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={newTaskName}
                      onChange={(e) => setNewTaskName(e.target.value)}
                      placeholder="Nombre de la tarea"
                      style={{ fontSize: 16 }}
                      className="flex-1 min-w-0 border border-gray-300 rounded px-3 py-2 text-sm"
                    />
                    <button
                      onClick={createTask}
                      disabled={!newTaskName.trim() || creatingTask}
                      className="text-sm bg-[#0170B9] text-white rounded px-3 disabled:opacity-40 shrink-0"
                    >
                      {creatingTask ? '...' : 'Crear'}
                    </button>
                  </div>
                )}
                <button
                  onClick={addRow}
                  disabled={!pickerTaskId || pickerTaskId === '__new__'}
                  className="w-full bg-[#0170B9] text-white rounded py-2 text-sm font-medium disabled:opacity-40"
                >
                  Agregar
                </button>
                {pickerProjectId && pickerTaskOptions.length === 0 && (
                  <span className="text-xs text-gray-400">Sin tareas disponibles en este proyecto.</span>
                )}
              </div>
            </>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto w-full">
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
                      Proyectos
                    </th>
                    {days.map((day, i) => (
                      <th key={day} style={{
                        backgroundColor: isToday(day) ? '#f59e0b' : isWeekendDay(day) ? '#7a9cbf' : '#0170B9',
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
                    {/* Spacer matching the delete-button column in <tbody> —
                        table-layout: fixed sizes columns off this header row,
                        so without this cell that column renders outside the
                        table's own computed width. */}
                    <th style={{ backgroundColor: '#005a94', width: 28, minWidth: 28 }} />
                  </tr>
                </thead>
                <tbody>
                  {isFetching && rowKeys.length === 0 && (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: '24px', color: '#9ca3af' }}>
                        Cargando...
                      </td>
                    </tr>
                  )}
                  {rowKeys.map((key) => {
                    const { projectId, taskId } = parseRowKey(key)
                    const row = grid.get(key) ?? {}
                    const rowTotal = days.reduce((s, d) => s + (row[d] ?? 0), 0)
                    return (
                      <tr key={key} className="hover:bg-blue-50">
                        <td style={{
                          position: 'sticky', left: 0, zIndex: 5,
                          backgroundColor: 'white',
                          borderRight: '2px solid #d1d5db', borderBottom: '1px solid #e5e7eb',
                          padding: '6px 10px', fontSize: isMobile ? 11 : 12,
                          width: NAME_W, minWidth: NAME_W,
                        }}>
                          <div className="flex items-center gap-1.5">
                            <span style={{
                              display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                              backgroundColor: rowColor(key), flexShrink: 0,
                            }} />
                            <span className="truncate">{rowLabel(key)}</span>
                          </div>
                        </td>
                        {days.map((day) => (
                          <td key={`${key}-${day}-${refreshKey}`} style={{
                            backgroundColor: isToday(day) ? '#fffbeb' : isWeekendDay(day) ? '#F3F4F6' : 'white',
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
                                saveCell(projectId, taskId, day, val)
                              }}
                              style={{ fontSize: inputFontSize }}
                              className="w-full text-center border-0 bg-transparent focus:bg-blue-50 focus:outline-none rounded py-1"
                            />
                          </td>
                        ))}
                        <td style={{
                          backgroundColor: '#F0F4FF', borderLeft: '2px solid #e5e7eb',
                          borderBottom: '1px solid #e5e7eb',
                          textAlign: 'right', padding: '6px 8px',
                          fontWeight: 'bold', color: '#0170B9', fontSize: isMobile ? 11 : 12,
                          width: TOTAL_W, minWidth: TOTAL_W,
                        }}>
                          {rowTotal > 0 ? formatHours(rowTotal) : ''}
                        </td>
                        <td style={{ width: 28, minWidth: 28, textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>
                          <button
                            onClick={() => removeRow(key)}
                            className="text-red-400 hover:text-red-600 transition-colors"
                            title="Eliminar fila"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}

                  {/* Add-row picker — Clockify-style "+ Seleccionar proyecto" */}
                  <tr>
                    <td style={{
                      position: 'sticky', left: 0, zIndex: 5,
                      backgroundColor: '#fafafa',
                      borderRight: '2px solid #d1d5db', borderBottom: '1px solid #e5e7eb',
                      padding: '6px 8px',
                      width: NAME_W, minWidth: NAME_W,
                    }}>
                      <div className="flex items-center gap-1 mb-1">
                        <Plus size={12} className="text-[#0170B9] shrink-0" />
                        <span className="text-[11px] text-gray-500">Seleccionar proyecto</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <SearchableSelect
                          value={pickerProjectId}
                          onChange={(v) => { setPickerProjectId(v); setPickerTaskId(''); setNewTaskName('') }}
                          options={projectOptions}
                          placeholder="Proyecto..."
                          className="border border-gray-300 rounded px-1.5 py-1 text-xs w-full"
                        />
                        <div className="flex gap-1">
                          <select
                            value={pickerTaskId}
                            onChange={(e) => setPickerTaskId(e.target.value)}
                            disabled={!pickerProjectId}
                            className="border border-gray-300 rounded px-1.5 py-1 text-xs flex-1 min-w-0 disabled:bg-gray-100"
                          >
                            <option value="">Tarea...</option>
                            {!pickerNoTaskAlreadyAdded && <option value="__none__">Sin tarea (Time & Material)</option>}
                            {pickerTaskOptions.map((t) => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                            <option value="__new__">+ Crear tarea nueva...</option>
                          </select>
                          <button
                            onClick={addRow}
                            disabled={!pickerTaskId || pickerTaskId === '__new__'}
                            className="text-xs bg-[#0170B9] text-white rounded px-2 disabled:opacity-40 shrink-0"
                          >
                            +
                          </button>
                        </div>
                        {pickerTaskId === '__new__' && (
                          <div className="flex gap-1">
                            <input
                              type="text"
                              value={newTaskName}
                              onChange={(e) => setNewTaskName(e.target.value)}
                              placeholder="Nombre de la tarea"
                              className="border border-gray-300 rounded px-1.5 py-1 text-xs flex-1 min-w-0"
                            />
                            <button
                              onClick={createTask}
                              disabled={!newTaskName.trim() || creatingTask}
                              className="text-xs bg-[#0170B9] text-white rounded px-2 disabled:opacity-40 shrink-0"
                            >
                              {creatingTask ? '...' : 'Crear'}
                            </button>
                          </div>
                        )}
                        {pickerProjectId && pickerTaskOptions.length === 0 && (
                          <span className="text-[10px] text-gray-400">Sin tareas disponibles en este proyecto.</span>
                        )}
                      </div>
                    </td>
                    <td colSpan={days.length + 2} style={{ backgroundColor: '#fafafa', borderBottom: '1px solid #e5e7eb' }} />
                  </tr>
                </tbody>
                {rowKeys.length > 0 && (
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
                        const dayTotal = rowKeys.reduce((s, k) => s + ((grid.get(k) ?? {})[day] ?? 0), 0)
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
                      <td colSpan={2} style={{
                        backgroundColor: '#005a94', color: 'white',
                        textAlign: 'right', padding: '6px 10px',
                        fontWeight: 'bold', fontSize: 13,
                        borderTop: '2px solid #005a94',
                        width: TOTAL_W + 28, minWidth: TOTAL_W + 28,
                      }}>
                        {formatHours(weekTotal)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          {/* T&M filters */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 font-medium">Proyecto</label>
              <SearchableSelect
                value={tmProjectId}
                onChange={setTmProjectId}
                options={projectOptions}
                placeholder="Seleccionar proyecto..."
                className="border border-gray-300 rounded px-2 py-1.5 text-sm min-w-[200px]"
              />
            </div>
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
              <label className="text-xs text-gray-500 font-medium">Horas por defecto</label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={tmDefaultHours}
                onChange={(e) => setTmDefaultHours(Number(e.target.value))}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm w-24"
              />
            </div>
            <button
              onClick={applyDefaultToAllDays}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Aplicar a todos los días
            </button>
          </div>

          {!tmProjectId ? (
            <div className="bg-white rounded-lg border border-gray-200 p-10 text-center text-gray-400 text-sm">
              Elegí un proyecto para cargar horas en bloque.
            </div>
          ) : tmEntriesError ? (
            <div className="bg-amber-50 border border-amber-300 text-amber-800 rounded-lg p-4 text-sm">
              {tmEntriesError.message}
            </div>
          ) : (
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
                        style={{ fontSize: inputFontSize }}
                        className="w-24 border border-gray-300 rounded px-2 py-1 text-center"
                      />
                    </div>
                  )
                })}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={saveTmMonth}
                  disabled={tmSaving}
                  className="px-4 py-2 bg-[#0170B9] text-white rounded text-sm hover:bg-[#005a94] disabled:opacity-50"
                >
                  {tmSaving ? 'Guardando...' : 'Guardar mes'}
                </button>
                <button
                  onClick={deleteTmMonth}
                  disabled={tmDeleting}
                  className="px-4 py-2 border border-red-300 text-red-600 rounded text-sm hover:bg-red-50 disabled:opacity-50"
                >
                  {tmDeleting ? 'Borrando...' : 'Borrar mes'}
                </button>
                {tmSavedMsg && <span className="text-sm text-gray-500">{tmSavedMsg}</span>}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
